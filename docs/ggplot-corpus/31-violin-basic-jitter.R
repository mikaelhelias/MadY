# ggplot2 reference: geom_violin + jitter
p <- ggplot(mtcars, aes(factor(cyl), mpg))
p + geom_violin() + geom_jitter(height = 0, width = 0.1)
