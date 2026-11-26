# ggplot2 reference: geom_point — aesthetics mapped to columns
ggplot(mtcars, aes(wt, mpg)) +
  geom_point(aes(colour = factor(cyl), shape = factor(cyl), size = qsec))
