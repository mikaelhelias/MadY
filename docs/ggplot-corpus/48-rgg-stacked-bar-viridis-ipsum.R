# R Graph Gallery #48: customised (viridis + hrbrthemes)
library(ggplot2)
library(viridis)
library(hrbrthemes)

specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)

ggplot(data, aes(fill=condition, y=value, x=specie)) +
    geom_bar(position="stack", stat="identity") +
    scale_fill_viridis(discrete = T) +
    ggtitle("Studying 4 species..") +
    theme_ipsum() +
    xlab("")
