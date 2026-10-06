# ggplot2 reference: geom_boxplot — grouped
p <- ggplot(mpg, aes(class, hwy))
p + geom_boxplot(aes(colour = drv))
